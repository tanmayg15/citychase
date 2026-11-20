/** Subtitles for the police radio clips (same text as the server's RADIO_LINES). */
import { RADIO_LINES } from '../actions/media-lines'

export const RADIO_TEXT = RADIO_LINES as Record<'start' | 'spotted' | 'lost' | 'smoke' | 'safehouse' | 'caught' | 'escaped', string>
