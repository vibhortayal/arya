import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

const cards = [
  ['What Arya is', '/docs/intro', 'The idea, the screens and how it uses Meta models.'],
  ['For judges', '/docs/judges', 'Where to look first, and what to try.'],
  ['User journeys', '/docs/guides/user-journeys', 'Walkthroughs with screenshots.'],
  ['Architecture', '/docs/architecture/overview', 'Routes, engines, models and storage.'],
  ['Lists API', '/docs/api/lists-api', 'Read and write your lists from a script.'],
  ['API reference', '/api-reference', 'Interactive OpenAPI reference.'],
];
export default function Home() {
  return (
    <Layout title="Arya docs" description="Documentation for Arya">
      <main style={{padding: '4rem 1rem', maxWidth: 960, margin: '0 auto'}}>
        <h1 style={{fontSize: '2.6rem'}}>Arya docs</h1>
        <p style={{fontSize: '1.2rem'}}>A grocery list that learns what you buy. Everything here is generated from the Markdown in the repo.</p>
        <div style={{display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', marginTop: '2rem'}}>
          {cards.map(([t, to, d]) => (
            <Link key={to} to={to} className="card padding--lg" style={{textDecoration: 'none'}}>
              <h3>{t}</h3><p style={{margin: 0}}>{d}</p>
            </Link>
          ))}
        </div>
      </main>
    </Layout>
  );
}
