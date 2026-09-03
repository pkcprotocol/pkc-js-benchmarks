// Ports and URLs of the self-contained local kubo network used by the reply-propagation
// benchmark. They are constants (not discovered at runtime) so that benchmark-options.ts can
// reference the reader-side URLs directly, and so the browser (chrome runtime) can be handed a
// pkcOptions object that is plain JSON.
//
// The range is deliberately away from pkc-js's own test server (15001-15006 / 18080-18085 /
// 24001-24006) so a running pkc-js test server does not collide with a benchmark run.
export interface KuboNodeConfig {
  name: string
  apiPort: number
  gatewayPort: number
  swarmPort: number
}

export const localKuboNodes = {
  // hosts the benchmark's own community (the only node the community publishes through)
  community: {name: 'community', apiPort: 15101, gatewayPort: 18101, swarmPort: 24101},
  // the *publishing* client's node: publishes the post and the reply over pubsub
  publisher: {name: 'publisher', apiPort: 15102, gatewayPort: 18102, swarmPort: 24102},
  // the *reading* client's node: used by the `kubo` and `ipfs-gateway` reader variants
  reader: {name: 'reader', apiPort: 15103, gatewayPort: 18103, swarmPort: 24103},
} as const satisfies Record<string, KuboNodeConfig>

export const kuboRpcUrl = (node: KuboNodeConfig): string => `http://127.0.0.1:${node.apiPort}/api/v0`
export const kuboGatewayUrl = (node: KuboNodeConfig): string => `http://127.0.0.1:${node.gatewayPort}`
// kubo serves the delegated routing API (/routing/v1) on the gateway port when
// Gateway.ExposeRoutingAPI is on — that is what a libp2p-js/helia reader uses as its http router,
// the same way a browser client uses routing.lol in production.
export const kuboHttpRouterUrl = (node: KuboNodeConfig): string => `http://127.0.0.1:${node.gatewayPort}`
