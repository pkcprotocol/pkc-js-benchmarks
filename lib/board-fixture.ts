import {execFileSync, spawnSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'fs-extra'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {BoardFixtureSpec} from '../types.ts'

// Seeded-board fixtures: built once by the OLDEST pkc-js in the backfill window (so its database is
// at the oldest schema every version under test can migrate from), cached in .fixtures/ by spec, and
// copied fresh for every cell. CI caches .fixtures/ between runs (see the workflows).

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const fixturesPath = path.join(rootPath, '.fixtures')

// The pkc-js that writes the fixtures. Must not be newer than the oldest version a seeded-board cell
// runs on: an older pkc-js cannot open a database a newer one migrated. 0.0.95 is the oldest of the
// last 20 releases (DB_VERSION 41); bump it together with the backfill window.
export const fixtureBuilderVersion = process.env.FIXTURE_PKC_JS_VERSION || '0.0.95'

export interface BoardFixture {
  dir: string
  // the pkc-js dataPath to copy for a cell
  dataPath: string
  address: string
  posts: number
  comments: number
  builtWith: string
}

const ensureBuilder = (version: string): string => {
  const dir = path.join(fixturesPath, `builder-${version}`)
  const installed = path.join(dir, 'node_modules', '@pkcprotocol', 'pkc-js', 'package.json')
  if (fs.existsSync(installed) && fs.readJsonSync(installed).version === version) return dir
  fs.ensureDirSync(dir)
  fs.writeJsonSync(path.join(dir, 'package.json'), {name: 'fixture-builder', private: true, type: 'module'})
  console.log(`installing pkc-js ${version} to build board fixtures...`)
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-save', `@pkcprotocol/pkc-js@${version}`], {cwd: dir, stdio: 'inherit'})
  return dir
}

export const ensureBoardFixture = (name: string, spec: BoardFixtureSpec): BoardFixture => {
  const hash = crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 10)
  const dir = path.join(fixturesPath, `board-${name}-${hash}-pkc-${fixtureBuilderVersion}`)
  const manifest = path.join(dir, 'fixture.json')
  if (!fs.existsSync(manifest)) {
    const builder = ensureBuilder(fixtureBuilderVersion)
    console.log(`building board fixture '${name}' ${JSON.stringify(spec)} with pkc-js ${fixtureBuilderVersion}...`)
    const result = spawnSync(process.execPath, [path.join(rootPath, 'lib', 'build-board-fixture.ts'), builder, dir, JSON.stringify(spec)], {
      stdio: 'inherit',
    })
    if (result.status !== 0 || !fs.existsSync(manifest)) {
      fs.removeSync(dir)
      throw Error(`building board fixture '${name}' failed (exit ${result.status})`)
    }
  }
  const fixture = fs.readJsonSync(manifest)
  return {dir, dataPath: path.join(dir, 'pkc-data'), ...fixture}
}

// sum of the community's sqlite files (database, -wal, -shm)
export const communityDbSizeBytes = (dataPath: string, address: string): number => {
  const dir = path.join(dataPath, 'communities')
  let total = 0
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(address)) total += fs.statSync(path.join(dir, file)).size
    }
  } catch (e) {
    // no database yet
  }
  return total
}
