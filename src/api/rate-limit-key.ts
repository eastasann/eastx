/**
 * レート制限のキー。IPv6 は利用者1人に /64 がまとめて割り当てられ、その中で送り元を自由に変えられるので、
 * 上位 64 ビットで数える。Cloudflare の前段は必ず cf-connecting-ip を付ける。無いのは前段を通らない呼び出しだけなので、
 * 1つのキーにまとめて数え、制限から外れる経路を作らない
 */
export function rateLimitKeyOf(ip: string | null): string {
  if (ip === null || ip === '') return 'unknown'
  if (!ip.includes(':')) return ip
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const headGroups = head === '' ? [] : head.split(':')
  const tailGroups = tail === '' ? [] : tail.split(':')
  // IPv4 を埋め込んだ末尾（::ffff:192.0.2.1）は 2 グループ分。上位 64 ビットには関わらないので数だけ合わせる
  const tailCount = tailGroups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0)
  // IPv4 を埋め込んだ IPv6（::ffff:192.0.2.1）は、中の IPv4 の送り元として数える
  const last = tailGroups.at(-1) ?? headGroups.at(-1) ?? ''
  if (last.includes('.') && /^(0+:)*ffff$/.test([...headGroups, ...tailGroups.slice(0, -1)].join(':') || ''))
    return last
  const fill = 8 - headGroups.length - tailCount
  // IPv6 として形の崩れた値は、そのままキーにする（Cloudflare が付ける値では起きない）
  if (ip.includes('::') ? fill < 0 : headGroups.length !== 8) return ip.toLowerCase()
  const groups = ip.includes('::') ? [...headGroups, ...Array<string>(fill).fill('0'), ...tailGroups] : headGroups
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}
