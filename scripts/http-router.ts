import http from 'node:http'

const response = {
  Providers: [
    {
      Schema: 'peer',
      Addrs: [
        '/ip4/89.36.231.48/tcp/4001/p2p/12D3KooWPjd6LyLDjK8Mrs4eRYNLsCYM3Yh9j4vpCgQXFazwSRP8',
      ],
      ID: '12D3KooWPjd6LyLDjK8Mrs4eRYNLsCYM3Yh9j4vpCgQXFazwSRP8',
      Protocols: ['transport-bitswap'],
    },
  ],
}

const server = http.createServer((_req, res) => {
  const json = JSON.stringify(response)
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
  })
  res.end(json)
})

const port = 9999
server.listen(port, () => {
  console.log(`http router listening on port ${port}`)
})
