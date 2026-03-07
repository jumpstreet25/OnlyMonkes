import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Video, ResizeMode } from 'expo-av';
import { uploadVideo } from '@/lib/videoUpload';
import { THEME, FONTS } from '@/lib/constants';

const MAX_DURATION = 30;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSend: (content: string) => void;
}

export function VideoCameraModal({ visible, onClose, onSend }: Props) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setVideoUri(null);
      setIsRecording(false);
      setUploading(false);
      setElapsed(0);
    }
  }, [visible]);

  // Timer while recording
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (!isRecording) setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const startRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    setIsRecording(true);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION });
      setIsRecording(false);
      if (result?.uri) setVideoUri(result.uri);
    } catch {
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    cameraRef.current?.stopRecording();
  }, []);

  const handleRecordPress = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleRetake = useCallback(() => {
    setVideoUri(null);
    setIsRecording(false);
    setElapsed(0);
  }, []);

  const handleSend = useCallback(async () => {
    if (!videoUri) return;
    setUploading(true);
    try {
      const { videoUrl, thumbUrl } = await uploadVideo(videoUri);
      onSend(`VIDEO:${videoUrl}|${thumbUrl}`);
    } catch (err: any) {
      const { Alert } = require('react-native');
      Alert.alert('Upload failed', err?.message ?? 'Could not upload video.');
    } finally {
      setUploading(false);
    }
  }, [videoUri, onSend]);

  const hasPermissions = cameraPermission?.granted && micPermission?.granted;

  const requestPermissions = useCallback(async () => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    if (!micPermission?.granted) await requestMicPermission();
  }, [cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  // Progress percentage for the recording bar
  const progressPct = Math.min(elapsed / MAX_DURATION, 1);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.container}>
        {!hasPermissions ? (
          <View style={styles.permContainer}>
            <Text style={styles.permText}>Camera and microphone access required.</Text>
            <Pressable style={styles.permBtn} onPress={requestPermissions}>
              <Text style={styles.permBtnText}>Grant Permissions</Text>
            </Pressable>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>
        ) : videoUri ? (
          // ── Preview mode ──
          <View style={styles.container}>
            <Video
              source={{ uri: videoUri }}
              style={styles.preview}
              shouldPlay
              isLooping
              resizeMode={ResizeMode.CONTAIN}
            />
            {/* Watermark */}
            <View style={styles.watermarkShadow}>
              <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={require('../../assets/watermark.png')}
                style={styles.watermark}
                resizeMode="contain"
              />
            </View>
            {/* Bottom bar */}
            <View style={styles.previewBar}>
              <Pressable style={styles.retakeBtn} onPress={handleRetake}>
                <Text style={styles.retakeBtnText}>↩ Retake</Text>
              </Pressable>
              <Pressable
                style={[styles.sendBtn, uploading && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.sendBtnText}>Send ↑</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          // ── Camera mode ──
          <View style={styles.container}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              mode="video"
              videoQuality="480p"
              facing="back"
            />
            {/* Close button */}
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={10}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
            {/* REC label + timer */}
            {isRecording && (
              <View style={styles.recLabel}>
                <View style={styles.recDot} />
                <Text style={styles.recText}>REC  {formatTime(elapsed)}</Text>
              </View>
            )}
            {/* Progress bar */}
            {isRecording && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct * 100}%` as any }]} />
              </View>
            )}
            {/* Record button */}
            <View style={styles.recordBtnContainer}>
              <View style={[styles.recordRing, isRecording && styles.recordRingActive]}>
                <Pressable
                  style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
                  onPress={handleRecordPress}
                />
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  preview: {
    flex: 1,
  },
  permContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  permText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontFamily: FONTS.body,
  },
  permBtn: {
    backgroundColor: THEME.accent,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONTS.bodySemi,
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  recLabel: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  recText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: FONTS.mono,
    letterSpacing: 1,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#FF3B30',
  },
  recordBtnContainer: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordRingActive: {
    borderColor: '#FF3B30',
  },
  recordBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  recordBtnActive: {
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    width: 34,
    height: 34,
  },
  // Preview
  watermarkShadow: {
    position: 'absolute',
    bottom: 90,
    right: 16,
    width: 128,
    height: 64,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 6,
  },
  watermark: {
    width: 128,
    height: 64,
    opacity: 0.9,
  },
  previewBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  retakeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  retakeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONTS.bodySemi,
  },
  sendBtn: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: THEME.accent,
    minWidth: 90,
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONTS.bodySemi,
  },
});
