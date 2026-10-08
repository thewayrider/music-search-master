function generateHTML(searchName, results) {
    const timestamp = new Date().toLocaleString();
    
    const cardsHtml = results.map(item => `
        <div class="card">
            <h3><a href="${item.url}" target="_blank">${item.title}</a></h3>
            <p><strong>Chart:</strong> <span class="badge">${item.channel}</span></p>
            <p><strong>Status:</strong> ${item.views}</p>
            <div class="video-container">
                <p><strong>Details:</strong></p>
                <p>${item.description}</p>
            </div>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Saved Search: ${searchName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
        
        :root {
            --bg-color: #0f172a;
            --text-color: #f8fafc;
            --card-bg: rgba(30, 41, 59, 0.7);
            --accent: #38bdf8;
            --accent-hover: #0284c7;
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 3rem 2rem;
            line-height: 1.6;
            min-height: 100vh;
        }
        header {
            margin-bottom: 4rem;
            text-align: center;
        }
        h1 {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 0.5rem;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .meta {
            color: #94a3b8;
            font-size: 1rem;
            font-weight: 400;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: blur(16px);
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
            border-color: rgba(56, 189, 248, 0.4);
        }
        .card h3 {
            margin-top: 0;
            margin-bottom: 1.5rem;
            font-size: 1.5rem;
        }
        .card a {
            color: var(--accent);
            text-decoration: none;
            transition: color 0.2s;
        }
        .card a:hover {
            color: var(--accent-hover);
        }
        .badge {
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 0.85rem;
            font-weight: 600;
            border: 1px solid rgba(56, 189, 248, 0.3);
            display: inline-block;
            margin-top: 4px;
        }
        .video-container {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 1px solid rgba(255,255,255,0.1);
            font-size: 0.95rem;
            color: #cbd5e1;
        }
        .video-container p {
            margin: 0 0 0.5rem 0;
        }
        .empty-state {
            text-align: center;
            color: #94a3b8;
            grid-column: 1 / -1;
            padding: 4rem;
            background: var(--card-bg);
            border-radius: 20px;
            border: 1px dashed rgba(255,255,255,0.2);
        }
    </style>
</head>
<body>
    <header>
        <h1>${searchName || 'Saved Search'}</h1>
        <p class="meta">Generated on ${timestamp} &bull; Found ${results.length} active channels</p>
    </header>
    <main class="grid">
        ${results.length > 0 ? cardsHtml : '<div class="empty-state">No active channels found for this search.</div>'}
    </main>
</body>
</html>`;
}

module.exports = { generateHTML };
