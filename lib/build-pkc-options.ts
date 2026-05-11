import {BsoResolver} from '@bitsocial/bso-resolver'
import type PKC from '@pkcprotocol/pkc-js'
import type {PkcOptions} from '../types.ts'

type PkcInput = Parameters<typeof PKC>[0]

// pkc-js 0.0.30 dropped the built-in `chainProviders` option in favor of
// `nameResolvers`. This helper preserves the legacy `chainProviders` shape in
// benchmark-options.ts (so it stays JSON-serializable for the browser-fetch
// path) and converts each URL into a BsoResolver instance at PKC-init time.
export const buildPkcOptions = (legacy: PkcOptions): PkcInput => {
  const {chainProviders, resolveAuthorAddresses, pubsubKuboRpcClients, ...rest} = legacy

  const nameResolvers: BsoResolver[] = []
  if (chainProviders) {
    for (const [chain, config] of Object.entries(chainProviders)) {
      if (!config) continue
      for (const provider of config.urls) {
        if (provider === 'ethers.js' || provider === 'web3.js') {
          // bso-resolver only supports 'viem' or an http(s)/wss URL
          continue
        }
        const keySuffix = provider === 'viem' ? 'viem' : new URL(provider).origin
        nameResolvers.push(new BsoResolver({key: `bso-${chain}-${keySuffix}`, provider}))
      }
    }
  }

  const input: Record<string, unknown> = {...rest}
  if (nameResolvers.length > 0) {
    input.nameResolvers = nameResolvers
  }
  if (resolveAuthorAddresses !== undefined) {
    input.resolveAuthorNames = resolveAuthorAddresses
  }
  if (pubsubKuboRpcClients !== undefined && input.pubsubKuboRpcClientsOptions === undefined) {
    input.pubsubKuboRpcClientsOptions = pubsubKuboRpcClients
  }

  return input as PkcInput
}
