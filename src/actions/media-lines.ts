/** Police radio lines, shared by the server (TTS generation) and the client (subtitles). */
/** Fixed radio lines (no player data in them), so each is generated once ever. */
export const RADIO_LINES: Record<string, string> = {
  start: 'All units, be advised. Getaway vehicle reported in the area. Eyes open.',
  spotted: 'Dispatch, I have a visual on the suspect. Moving in.',
  lost: 'Lost visual. Suspect is on the move. Search the last known location.',
  smoke: 'Smoke! I cannot see a thing! Suspect slipped away.',
  safehouse: 'All units, suspect is heading for the safehouse. Cut them off!',
  caught: 'Suspect in custody. Nice work, everyone.',
  escaped: 'Negative, suspect is gone. Damn it.',
}
