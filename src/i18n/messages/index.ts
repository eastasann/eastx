import type { Lang } from '../detect'
import { en } from './en'
import { ja, type Messages } from './ja'

export type { Messages }

const MESSAGES: Record<Lang, Messages> = { ja, en }

export function getMessages(lang: Lang): Messages {
  return MESSAGES[lang]
}
