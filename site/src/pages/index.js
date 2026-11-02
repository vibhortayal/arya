import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

const cards = [
  ['What Arya is', '/docs/intro', 'The idea, the screens and how it uses Meta models.'],
  ['For judges', '/docs/judges', 'Where to look first, and what to try.'],
  ['Try the features', '/docs/try-the-features', 'Every feature, step by step, on your own copy.'],
  ['User journeys', '/docs/guide/user-journeys', 'Walkthroughs with screenshots.'],
  ['Lists API', '/docs/api/lists-api', 'Read and write your lists from a script.'],
  ['API reference', '/api-reference', 'Interactive OpenAPI reference.'],
];
export default function Home() {
  return (
    <Layout title="Arya docs" description="Documentation for Arya">
      <main style={{padding: '4rem 1rem', maxWidth: 960, margin: '0 auto'}}>
        <h1 style={{fontSize: '2.6rem'}}>Arya docs</h1>
        <p style={{fontSize: '1.2rem'}}>Build for Your World, in three parts.</p>
        <ul style={{fontSize: '1.05rem'}}>
          <li><strong>What Arya is.</strong> A grocery list that learns from your receipts, then mostly writes itself.</li>
          <li><strong>Why we built it.</strong> I had this problem: carrying the list in my head, forgetting what was running out, not knowing where the money went. Arya frees up that time and mental space. Arya is free to use, made for shoppers to help each other, and nothing in it is for sale: households and groups share lists. <Link to="/docs/principles">Principles and goals</Link></li>
          <li><strong>What it uses.</strong> Meta's models: Muse Spark, Muse Wonder, SAM 3.1, Muse Voice Transcribe, Muse Image and Muse Spark Open, each with one job. <Link to="/docs/judges">Model map</Link></li>
        </ul>
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
