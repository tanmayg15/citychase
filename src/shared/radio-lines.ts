/**
 * Police radio lines, shared by the server (TTS generation) and the client
 * (subtitles). Fixed text with no player data, so each clip is generated once
 * ever and cached. Several ids per moment (spotted, spotted2, …) rotate so
 * the radio doesn't repeat itself.
 */
export const RADIO_LINES = {
  start: 'All units, be advised. Getaway vehicle reported in the area. Eyes open.',
  spotted: 'Dispatch, I have a visual on the suspect. Moving in.',
  spotted2: 'Ten-four, suspect vehicle in sight. Pursuing.',
  spotted3: 'Got eyes on them! All units, converge!',
  lost: 'Lost visual. Suspect is on the move. Search the last known location.',
  smoke: 'Smoke! I cannot see a thing! Suspect slipped away.',
  safehouse: 'All units, suspect is heading for the safehouse. Cut them off!',
  caught: "Vehicle stopped! Wait... they've switched cars. Stay sharp.",
  lastlife: "That's two down. One car left. Do not let them slip this time.",
  respawn: 'All units, reset. New getaway car on the move.',
  busted: "Suspect in custody. Nice work, everyone. That's a wrap.",
  escaped: 'Negative, suspect is gone. Damn it.',
  nitro: "They're punching it! Way too fast, I can't keep up!",
  spinout: "I'm sliding! Oil on the road! Unit down!",
  disguise: "Where'd they go? I've lost the vehicle. Anyone got eyes?",
  lowtime: 'Thirty seconds, people. Lock it down.',
} as const

export type RadioId = keyof typeof RADIO_LINES
