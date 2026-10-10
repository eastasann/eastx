import { describe, expect, it } from 'vitest'
import { deviceOf, isBot } from './bots'

describe('isBot', () => {
  it.each([
    'Mozilla/5.0 (compatible; SentryUptimeBot/1.0; +http://docs.sentry.io/product/alerts/uptime-monitoring/)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Chrome-Lighthouse',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/138.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)',
    'Mozilla/5.0 (compatible; Applebot/0.1)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'Mozilla/5.0 (compatible; YandexSpider/3.0)',
    'Google Web Preview',
  ])('ボット: %s', (userAgent) => {
    expect(isBot(userAgent)).toBe(true)
  })

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  ])('普通のブラウザは通す: %s', (userAgent) => {
    expect(isBot(userAgent)).toBe(false)
  })

  it('User-Agent が無い・空はボットとして扱う', () => {
    expect(isBot(null)).toBe(true)
    expect(isBot('  ')).toBe(true)
  })
})

describe('deviceOf', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Mobile/15E148 Safari/604.1', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0.0.0 Mobile Safari/537.36', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 15; SM-X710) Chrome/141.0.0.0 Safari/537.36', 'tablet'],
    ['Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) Mobile/15E148 Safari/604.1', 'tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.6 Safari/605.1.15', 'desktop'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36', 'desktop'],
  ])('%s → %s', (userAgent, device) => {
    expect(deviceOf(userAgent)).toBe(device)
  })
})
