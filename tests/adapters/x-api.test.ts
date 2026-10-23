import { describe, expect, it, vi } from 'vitest';
import { collectRecords } from '@/adapters/x-api/collect';
import { installApiReader, operationName } from '@/adapters/x-api/reader';
import { loadJsonFixture as fixture } from '../helpers';

describe('collectRecords', () => {
  it('reads the current GraphQL shape (core.*, avatar.image_url)', () => {
    const { users, posts } = collectRecords(fixture('home-timeline.graphql.json'));
    expect(users.map((u) => u.handle).sort()).toEqual(['Srihars47664037', 'longform_writer', 'priya_runs', 'troll_acct']);

    const troll = users.find((u) => u.handle === 'Srihars47664037')!;
    expect(troll).toMatchObject({
      id: '9001',
      followers: 12,
      following: 480,
      defaultAvatar: true,
      bio: 'Follow back guaranteed',
      blueVerified: false,
      createdAt: Date.parse('2026-10-14T10:00:00Z'),
      source: 'api',
    });

    const reply = posts.find((p) => p.id === '2002')!;
    expect(reply).toMatchObject({ authorHandle: 'Srihars47664037', lang: 'hi', inReplyToStatusId: '1999' });
  });

  it('unwraps TweetWithVisibilityResults and prefers the long note_tweet text', () => {
    const { posts } = collectRecords(fixture('home-timeline.graphql.json'));
    const long = posts.find((p) => p.id === '2005')!;
    expect(long.authorHandle).toBe('longform_writer');
    expect(long.text).toContain('you absolute dickhead');
  });

  it('links a quote to the quoted post, which is read as a post of its own', () => {
    const { posts } = collectRecords(fixture('home-timeline.graphql.json'));
    expect(posts.find((p) => p.id === '2003')?.quotedId).toBe('1990');
    expect(posts.find((p) => p.id === '1990')).toMatchObject({ authorHandle: 'troll_acct', text: '@newsdesk shut the fuck up, nobody asked' });
    // Older responses only have the id.
    const [legacy] = collectRecords({ rest_id: '5', legacy: { full_text: 'look', quoted_status_id_str: '4' } }).posts;
    expect(legacy?.quotedId).toBe('4');
  });

  it('reads whether you follow an account, in the current and older shapes', () => {
    const user = (extra: object, legacy: object = {}) =>
      collectRecords({ rest_id: '1', core: { screen_name: 'a' }, legacy: { followers_count: 5, ...legacy }, ...extra }).users[0]?.youFollow;
    expect(user({ relationship_perspectives: { following: true } })).toBe(true);
    expect(user({ relationship_perspectives: { following: false } }, { following: true })).toBe(false);
    expect(user({}, { following: true })).toBe(true);
    expect(user({})).toBeUndefined();
    expect(collectRecords({ id_str: '2', screen_name: 'b', followers_count: 1, following: true }).users[0]?.youFollow).toBe(true);
  });

  it('reads the older shape with handle and date under legacy', () => {
    const { users, posts } = collectRecords(fixture('tweet-detail.legacy-shape.json'));
    expect(users).toEqual([
      expect.objectContaining({ handle: 'rahul48213977', followers: 12, defaultAvatar: true, createdAt: Date.parse('2026-10-14T10:00:00Z') }),
    ]);
    expect(posts[0]).toMatchObject({ id: '3007', authorHandle: 'rahul48213977', inReplyToStatusId: '3000' });
  });

  it('reads REST globalObjects (notifications) and joins authors by id', () => {
    const { users, posts } = collectRecords(fixture('notifications.rest.json'));
    expect(users[0]).toMatchObject({ handle: 'kattar_x', followers: 3, following: 900, bio: 'DM for paid promotion' });
    expect(posts.find((p) => p.id === '4001')).toMatchObject({ authorHandle: 'kattar_x', lang: 'hi', inReplyToHandle: 'downlz' });
    expect(posts).toHaveLength(2);
  });

  it('ignores unrelated JSON', () => {
    expect(collectRecords({ data: { viewer: { settings: [1, 2, 3] } } })).toEqual({ users: [], posts: [] });
  });
});

describe('installApiReader', () => {
  class FakeResponse {
    constructor(
      readonly url: string,
      private readonly body: string,
    ) {}
    async json() {
      return JSON.parse(this.body) as unknown;
    }
    async text() {
      return this.body;
    }
  }
  class FakeXHR {
    readyState = 0;
    body = '';
    open(_method: string, _url: string) {}
    get response() {
      return this.body;
    }
    get responseText() {
      return this.body;
    }
  }

  it('sees fetch and XHR responses from /i/api/ before the caller does, without changing them', async () => {
    const win = { Response: FakeResponse, XMLHttpRequest: FakeXHR } as unknown as typeof globalThis;
    const seen: string[] = [];
    const listener = vi.fn((url: string) => seen.push(operationName(url)));
    installApiReader(win, listener);

    const body = JSON.stringify({ ok: true });
    const response = new FakeResponse('https://x.com/i/api/graphql/abc/HomeTimeline?variables=%7B%7D', body);
    expect(await response.json()).toEqual({ ok: true });
    expect(await new FakeResponse('https://x.com/i/api/2/notifications/all.json', body).text()).toBe(body);
    await new FakeResponse('https://abs.twimg.com/responsive-web/client.js', body).json();

    const xhr = new FakeXHR();
    xhr.open('GET', 'https://x.com/i/api/graphql/def/TweetDetail');
    xhr.body = body;
    xhr.readyState = 4;
    expect(xhr.responseText).toBe(body);
    expect(xhr.response).toBe(body);

    expect(seen).toEqual(['HomeTimeline', '/i/api/2/notifications/all.json', 'TweetDetail']);
  });

  it('never throws into X when a body is not JSON', async () => {
    const win = { Response: FakeResponse, XMLHttpRequest: FakeXHR } as unknown as typeof globalThis;
    installApiReader(win, () => undefined);
    await expect(new FakeResponse('https://x.com/i/api/1.1/foo', '<html>').text()).resolves.toBe('<html>');
  });
});
