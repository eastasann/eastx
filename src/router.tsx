import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { DefaultRouteError } from './site/status-pages'

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultErrorComponent: DefaultRouteError,
  })
}
