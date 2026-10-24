import { routeForLink, holdLink, takeHeldLink } from '../lib/deepLinks';

describe('routeForLink', () => {
  it('opens invites from the app scheme and the /r/ link', () => {
    expect(routeForLink('onlymonkes://invite/5nfg8a')).toBe('/invite?code=5NFG8A');
    expect(routeForLink('https://onlymonkes.app/r/5NFG8A')).toBe('/invite?code=5NFG8A');
    expect(routeForLink('onlymonkes://invite/5NFG8')).toBeNull();
    expect(routeForLink('onlymonkes://invite/5NFG8I')).toBeNull();
  });

  it('maps onlymonkes.app/open targets and their app intents', () => {
    expect(routeForLink('onlymonkes://chat')).toBe('/chat');
    expect(routeForLink('onlymonkes://open/genesis')).toBe('/genesis-chat');
    expect(routeForLink('onlymonkes://genesis-chat')).toBe('/genesis-chat');
    expect(routeForLink('onlymonkes://bot-channel?channelId=trades')).toBe('/bot-channel?channelId=trades');
    expect(routeForLink('https://onlymonkes.app/open/marketplace')).toBe('/marketplace');
    expect(routeForLink('/monkememe')).toBe('/monkememe');
  });
  it('keeps the legacy dm/ and channel/ forms', () => {
    const id = 'a'.repeat(64);
    expect(routeForLink(`onlymonkes://dm/${id}`)).toBe(`/dm/${id}`);
    expect(routeForLink('onlymonkes://channel/trades')).toBe('/bot-channel?channelId=trades');
  });
  it('ignores anything that is not ours', () => {
    expect(routeForLink('onlymonkes://dm/not-an-inbox')).toBeNull();
    expect(routeForLink('onlymonkes://bot-channel?channelId=bets')).toBeNull();
    expect(routeForLink('onlymonkes://matrica?code=abc')).toBeNull();
    expect(routeForLink('exp+onlymonkes://expo-development-client/?url=x')).toBeNull();
    expect(routeForLink('https://evil.example/open/chat')).toBeNull();
    expect(routeForLink('/')).toBeNull();
  });
  it('holds one link until taken', () => {
    holdLink('/marketplace');
    expect(takeHeldLink()).toBe('/marketplace');
    expect(takeHeldLink()).toBeNull();
  });
});
