import type { Lang } from '../detect'
import type { Messages } from './ja'

const LANG_NAMES: Record<Lang, string> = { ja: 'Japanese', en: 'English' }

export const en = {
  siteName: 'eastasian',
  section: {
    profile: 'Profile',
    career: 'Career',
    projects: 'Projects',
    works: 'Works',
    stack: 'Tech Stack',
    blog: 'Blog',
    coding: 'Coding Log',
  },
  careerKind: { work: 'Work', education: 'Education' },
  codingLogKind: {
    learning_log: 'Learning Log',
    snippet: 'Snippet',
    problem: 'Problem Solving',
    memo: 'Tech Memo',
  },
  period: { present: 'Present' },
  action: {
    readMore: 'Read more',
    close: 'Close',
    visitSite: 'Visit site',
    github: 'GitHub',
    reload: 'Reload',
    backToTop: 'Back to home',
  },
  label: {
    onlyIn: (lang: Lang): string => `${LANG_NAMES[lang]} only`,
    opensInNewTab: 'Opens in a new tab',
    reference: 'Reference',
    updated: 'Updated',
  },
  notice: {
    postOnlyIn: (lang: Lang): string => `This post is available in ${LANG_NAMES[lang]} only.`,
    codingLogOnlyIn: (lang: Lang): string => `This log is available in ${LANG_NAMES[lang]} only.`,
    workBodyOnlyIn: (lang: Lang): string => `The description of this work is available in ${LANG_NAMES[lang]} only.`,
    projectBodyOnlyIn: (lang: Lang): string =>
      `The description of this project is available in ${LANG_NAMES[lang]} only.`,
  },
  back: {
    works: 'Back to Works',
    projects: 'Back to Projects',
    blog: 'Back to Blog',
    coding: 'Back to Coding Log',
  },
  neighbor: {
    prevWork: 'Previous work',
    nextWork: 'Next work',
    prevProject: 'Previous project',
    nextProject: 'Next project',
    newerPost: 'Newer post',
    olderPost: 'Older post',
    newerLog: 'Newer log',
    olderLog: 'Older log',
  },
  paging: {
    previous: 'Previous page',
    next: 'Next page',
    position: (current: number, total: number): string => `${current} / ${total}`,
    announce: (current: number, total: number): string => `Page ${current} of ${total}`,
  },
  header: {
    sectionNav: 'Sections',
    menu: 'Menu',
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
