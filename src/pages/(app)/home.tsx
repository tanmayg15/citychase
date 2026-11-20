/** Daily City home: today's city, the play button, and today's verified leaderboard. */
import { Link } from 'react-router-dom'
import { getCity } from '@/cities'
import { dailyFor, utcDate } from '@/game/daily'
import { Leaderboard } from '@/game/Leaderboard'
import { WeatherInfo } from '@/game/WeatherInfo'

export default function HomePage() {
  const daily = dailyFor(utcDate())
  const city = getCity(daily.cityId)!

  return (
    <div className="min-h-full px-4 py-8 text-[#e8e0ff]" style={{ background: '#07030f' }}>
      <div className="mx-auto max-w-xl">
        <p className="text-xs uppercase tracking-[0.3em] text-fuchsia-300/80">Daily City · {daily.date} (UTC)</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight" style={{ textShadow: '0 0 18px #8b5cf6' }}>
          {city.name}, {city.city}
        </h1>
        <p className="mt-2 text-sm opacity-70">
          Everyone plays the same real street grid today. Collect the orbs, dodge the drones, grab a power core to
          turn the chase around.
        </p>
        <WeatherInfo city={city} />

        <Link
          to="/play"
          data-testid="play-daily"
          className="mt-6 inline-block rounded-lg bg-cyan-400 px-6 py-3 font-bold text-black shadow-[0_0_24px_#37f5ff] hover:bg-cyan-300"
        >
          Play today's city
        </Link>
        <p className="mt-2 text-xs opacity-50">Arrow keys / WASD, or swipe. Scores are verified by replaying your run on the server.</p>

        <h2 className="mb-3 mt-10 text-lg font-semibold">Today's leaderboard</h2>
        <Leaderboard date={daily.date} />
        <p className="mt-8 text-xs opacity-40">{city.attribution}</p>
      </div>
    </div>
  )
}
