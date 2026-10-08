import type { Lang } from '../detect'
import { SECTION_NAMES } from '../section-names'
import type { Messages } from './ja'

const LANG_NAMES: Record<Lang, string> = { ja: 'Japanese', en: 'English' }

export const en = {
  siteName: 'eastasian',
  section: { profile: 'Profile', ...SECTION_NAMES },
  careerKind: { work: 'Work', education: 'Education' },
  codingLogKind: {
    learning_log: 'Learning Log',
    snippet: 'Snippet',
    problem: 'Problem Solving',
    memo: 'Tech Memo',
  },
  period: { present: 'Present' },
  action: {
    viewDetails: 'View details',
    visitSite: 'Visit site',
    github: 'GitHub',
    reload: 'Reload',
    backToTop: 'Back to home',
  },
  label: {
    onlyIn: (lang: Lang): string => `${LANG_NAMES[lang]} only`,
    moreStacks: (count: number): string => `${count} more`,
    opensInNewTab: 'Opens in a new tab',
    reference: 'Reference',
    updated: 'Updated',
  },
  notice: {
    postOnlyIn: (lang: Lang): string => `This post is available in ${LANG_NAMES[lang]} only.`,
    codingLogOnlyIn: (lang: Lang): string => `This log is available in ${LANG_NAMES[lang]} only.`,
    bodyOnlyIn: (lang: Lang): string => `This description is available in ${LANG_NAMES[lang]} only.`,
  },
  backLink: (): { before: string; after: string } => ({ before: 'Back to', after: '' }),
  neighbor: {
    nav: 'Previous and next',
    previous: 'Previous',
    next: 'Next',
    newerPost: 'Newer post',
    olderPost: 'Older post',
    newerLog: 'Newer log',
    olderLog: 'Older log',
  },
  paging: {
    controlsSuffix: 'pages',
    previous: 'Previous page',
    next: 'Next page',
    position: (current: number, total: number): string => `${current} / ${total}`,
    announce: (current: number, total: number): string => `Page ${current} of ${total}`,
  },
  header: {
    language: 'Language',
  },
  footer: {
    copyright: '© eastasian',
    social: 'Social links',
  },
  theme: {
    toggle: (current: string, next: string): string => `Theme: ${current} (switch to ${next})`,
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  },
  code: {
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: "Couldn't copy",
  },
  notFound: {
    title: 'Page not found',
    body: 'The page you are looking for does not exist or is not public.',
  },
  error: {
    title: "This page can't be displayed right now",
    body: 'Please reload after a while.',
  },
} satisfies Messages
