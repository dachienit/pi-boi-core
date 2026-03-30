import { createServer } from 'http';
import { request } from 'https';

const proxy = createServer((req, res) => {
    // Append api-version to the incoming URL
    const targetPath = `/api/openai/deployments/gpt-5-nano-2025-08-07${req.url}?api-version=2025-04-01-preview`;
    
    console.log(`[Proxy] Forwarding ${req.method} ${req.url} -> ${targetPath} (via 127.0.0.1:3128)`);
    
    // Note: To support HTTPS targets via an HTTP parent proxy, 
    // we use the full URL in the path for the proxy request.
    const options = {
        hostname: '127.0.0.1',
        port: 3128,
        path: `https://aoai-farm.bosch-temp.com${targetPath}`,
        method: req.method,
        headers: {
            ...req.headers,
            host: 'aoai-farm.bosch-temp.com'
        },
        rejectUnauthorized: false // Ignore SSL certificate issues in corporate networks
    };
    
    const proxyReq = request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });
    
    proxyReq.on('error', (err) => {
        console.error('[Proxy] Error:', err);
        res.statusCode = 500;
        res.end();
    });
    
    req.pipe(proxyReq, { end: true });
});

proxy.listen(8080, () => {
    console.log("Local Azure Proxy listening on http://localhost:8080");
});
