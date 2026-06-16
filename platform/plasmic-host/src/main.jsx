import React from 'react'
import ReactDOM from 'react-dom/client'
import { PlasmicCanvasHost } from '@plasmicapp/host'

// --- Hostless code-component registrations ---------------------------------
// On a self-hosted instance, hostless packages added to a project show up in
// the Studio insert menu (Studio reads their metadata), but the CANVAS HOST
// must actually register the component code or click/drag places nothing.
// Register each package's registerAll() against the global @plasmicapp/host.
// Wrapped per-package so one bad package can't blank the whole host.
import { registerAll as registerAntd5 } from '@plasmicpkgs/antd5'

const registrars = [
  ['@plasmicpkgs/antd5', registerAntd5],
]

for (const [name, register] of registrars) {
  try {
    register()
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[plasmic-host] failed to register ${name}:`, e)
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <PlasmicCanvasHost />
)
