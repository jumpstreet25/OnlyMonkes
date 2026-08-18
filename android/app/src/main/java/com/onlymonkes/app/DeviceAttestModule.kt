package com.onlymonkes.app

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature

/**
 * DeviceAttestModule — Data Oracle Phase 1's "honest substitute" for TEEPIN attestation.
 *
 * No public TEEPIN attestation API exists for third-party apps as of this writing (checked
 * docs.solanamobile.com directly — Seed Vault, the actual TEE component on Seeker, is scoped
 * only to Solana transaction signing, not general data attestation; the Guardian Network is
 * staking/governance, not a per-submission endpoint). This uses Android's own hardware
 * attestation instead: a non-exportable EC P-256 key generated in Android Keystore,
 * StrongBox-backed where the device supports it, falling back to normal Keystore
 * (TEE-backed, on any device with a TEE) otherwise. Every sentiment batch is signed with
 * this key.
 *
 * The attestation certificate chain (rooted at Google's Android hardware attestation root)
 * is captured here and exposed to JS, but the worker (sentimentOracle.ts) does not currently
 * parse its KeyDescription extension to confirm hardware provenance server-side — Phase 1's
 * server-side trust is the signature + the device→wallet binding, not a verified attestation
 * chain. That's a real gap versus "true" attestation, left for a follow-up rather than
 * building ASN.1 KeyDescription parsing into the worker's phase-1 scope.
 */
class DeviceAttestModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "DeviceAttest"

    companion object {
        private const val ALIAS = "onlymonkes_sentiment_device_key_v1"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    }

    private fun keyStore(): KeyStore =
        KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

    private fun generateKey(strongBox: Boolean) {
        val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
        // Baked into the key's attestation cert at generation time — not a per-signature
        // freshness nonce (that would need a server-issued challenge round-trip, out of
        // scope for phase 1's honest-substitute stack).
        val challenge = reactContext.packageName.toByteArray(Charsets.UTF_8)
        val specBuilder = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
        if (strongBox) specBuilder.setIsStrongBoxBacked(true)
        kpg.initialize(specBuilder.build())
        kpg.generateKeyPair()
    }

    /**
     * Generates the device key on first call (StrongBox-backed if available, TEE-backed
     * otherwise), idempotent after that — Android Keystore persists the key across app
     * restarts and updates (not across uninstalls, and CLAUDE.md forbids `adb uninstall`
     * for unrelated XMTP reasons anyway, so that's not a concern in normal dev flow here).
     */
    private fun ensureKey() {
        val ks = keyStore()
        if (ks.containsAlias(ALIAS)) return
        // KeyGenParameterSpec.Builder.setIsStrongBoxBacked() doesn't exist before API 28 —
        // calling it on API 26/27 (this module's minSdk is 26, see android/gradle.properties)
        // throws NoSuchMethodError, which is an Error, NOT an Exception, so it would NOT be
        // caught by the generic `catch (e: Exception)` below. Gate on SDK_INT first rather
        // than relying on try/catch alone.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                generateKey(strongBox = true)
                return
            } catch (e: StrongBoxUnavailableException) {
                // fall through to non-StrongBox generation below
            } catch (e: Exception) {
                // Some builds throw a plain exception rather than StrongBoxUnavailableException
                // for "no StrongBox on this device" — fall back the same way either way.
            }
        }
        generateKey(strongBox = false)
    }

    @ReactMethod
    fun getOrCreatePublicKey(promise: Promise) {
        try {
            ensureKey()
            val cert = keyStore().getCertificate(ALIAS)
            // X.509 SubjectPublicKeyInfo DER — matches what the worker's
            // crypto.subtle.importKey("spki", ...) expects.
            promise.resolve(Base64.encodeToString(cert.publicKey.encoded, Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("DEVICE_ATTEST_KEY_ERROR", e)
        }
    }

    @ReactMethod
    fun getAttestationCertChain(promise: Promise) {
        try {
            ensureKey()
            val chain = keyStore().getCertificateChain(ALIAS) ?: arrayOf()
            val encoded = Arguments.createArray()
            for (c in chain) {
                encoded.pushString(Base64.encodeToString(c.encoded, Base64.NO_WRAP))
            }
            promise.resolve(encoded)
        } catch (e: Exception) {
            promise.reject("DEVICE_ATTEST_CHAIN_ERROR", e)
        }
    }

    /** Informational — never a hard gate. Lets the app label its own consent copy honestly
     *  ("hardware-backed" vs "StrongBox-backed") instead of overclaiming on every device. */
    @ReactMethod
    fun getKeyInfo(promise: Promise) {
        try {
            ensureKey()
            val privateKey = keyStore().getKey(ALIAS, null) as PrivateKey
            val factory = KeyFactory.getInstance(privateKey.algorithm, KEYSTORE_PROVIDER)
            val info = factory.getKeySpec(privateKey, KeyInfo::class.java)
            val result: WritableMap = Arguments.createMap()
            result.putBoolean("insideSecureHardware", info.isInsideSecureHardware)
            // KeyInfo.isStrongBoxBacked() requires API 28 — this module's minSdk is 26
            // (see android/gradle.properties), so guard rather than assume.
            val strongBox = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.isStrongBoxBacked
            } else {
                false
            }
            result.putBoolean("strongBoxBacked", strongBox)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("DEVICE_ATTEST_INFO_ERROR", e)
        }
    }

    @ReactMethod
    fun sign(payloadBase64: String, promise: Promise) {
        try {
            ensureKey()
            val privateKey = keyStore().getKey(ALIAS, null) as PrivateKey
            val payload = Base64.decode(payloadBase64, Base64.NO_WRAP)
            val sig = Signature.getInstance("SHA256withECDSA")
            sig.initSign(privateKey)
            sig.update(payload)
            // DER-encoded (r,s) — sentimentOracle.ts's derToRawEcdsaSignature() converts
            // this to the raw r||s form Web Crypto's ECDSA verify expects.
            promise.resolve(Base64.encodeToString(sig.sign(), Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("DEVICE_ATTEST_SIGN_ERROR", e)
        }
    }
}
