/**
 * /robots.txt の中身（ADR-019）。本番は管理画面と API だけを拒否し、それ以外の環境（staging・ローカル）はすべてを拒否する
 */
export function robotsTxt(environment: string): string {
  const rules = environment === 'production' ? ['Disallow: /admin', 'Disallow: /api'] : ['Disallow: /']
  return ['User-agent: *', ...rules, ''].join('\n')
}
