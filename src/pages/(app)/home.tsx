/** /home is kept as an alias: the lobby at / is the one home page. */
import { Navigate } from 'react-router-dom'

export default function HomeRedirect() {
  return <Navigate to="/" replace />
}
