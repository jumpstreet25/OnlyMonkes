import catalog from '../../config/bot-commands.json';
import { parseBotCommands, commandsFor, slashSuggestions, commandDesc } from '../lib/botCommands';

const all = parseBotCommands(catalog)!;

describe('bot command catalog', () => {
  it('parses every entry', () => {
    expect(all).not.toBeNull();
    expect(all.length).toBe((catalog as { commands: unknown[] }).commands.length);
  });

  it('has English and Spanish text for every command', () => {
    for (const c of all) {
      expect(c.desc.en.length).toBeGreaterThan(0);
      expect(c.desc.es?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('has no duplicate command per context', () => {
    for (const scope of ['chat', 'dm'] as const) {
      const keys = commandsFor(all, scope, true).map((c) => c.cmd);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('keeps admin commands DM-only and hidden from non-admins', () => {
    const admin = all.filter((c) => c.admin);
    expect(admin.length).toBeGreaterThan(0);
    for (const c of admin) expect(c.where).toEqual(['dm']);
    expect(commandsFor(all, 'dm', false).some((c) => c.admin)).toBe(false);
    expect(commandsFor(all, 'dm', true).some((c) => c.cmd === '/announce')).toBe(true);
  });

  it('does not list commands the bot never handled', () => {
    const cmds = all.map((c) => c.cmd.split(' ')[0]);
    for (const dead of ['/whale', '/dca', '/globe']) expect(cmds).not.toContain(dead);
  });
});

describe('slashSuggestions', () => {
  it('only suggests after a slash, and only real slash commands', () => {
    expect(slashSuggestions(all, 'hello', 'dm', false)).toEqual([]);
    expect(slashSuggestions(all, '/', 'dm', false).every((c) => c.cmd.startsWith('/'))).toBe(true);
  });

  it('matches by prefix within the context', () => {
    const dm = slashSuggestions(all, '/hooked', 'dm', false).map((c) => c.cmd);
    expect(dm).toEqual(['/hooked-report']);
    expect(slashSuggestions(all, '/hooked', 'chat', false)).toEqual([]);
  });

  it('shows the DM wording of /buy in DMs and the Jupiter wording in Main Chat', () => {
    const dmBuy = slashSuggestions(all, '/buy', 'dm', false);
    const chatBuy = slashSuggestions(all, '/buy', 'chat', false);
    expect(dmBuy).toHaveLength(1);
    expect(chatBuy).toHaveLength(1);
    expect(commandDesc(dmBuy[0], 'en')).not.toBe(commandDesc(chatBuy[0], 'en'));
  });

  it('localizes descriptions', () => {
    const help = all.find((c) => c.cmd === '/help')!;
    expect(commandDesc(help, 'es')).toBe('Todos los comandos');
    expect(commandDesc(help, 'en')).toBe('All commands');
  });
});
