/** /home is where sign-in (OAuth) lands (src/server/http-routes.ts); it forwards to the lobby at /. */
import { Navigate } from 'react-router-dom'

export default function HomeRedirect() {
  return <Navigate to="/" replace />
}
