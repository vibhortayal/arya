import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

const cards = [
  ['What is Arya?', '/docs/intro', 'The idea, the screens and how it uses Meta models.'],
  ['What should a judge look at?', '/docs/judges', 'Where to look first, and what to try.'],
  ['How do I try every feature?', '/docs/try-the-features', 'Every feature, step by step, on your own copy.'],
  ['What can I do with it?', '/docs/guide/user-journeys', 'User journeys: walkthroughs with screenshots.'],
  ['How do I use the Lists API?', '/docs/api/lists-api', 'Read and write your lists from a script.'],
  ['Where is the API reference?', '/api-reference', 'Interactive OpenAPI reference.'],
];
export default function Home() {
  return (
    <Layout title="Arya docs" description="Documentation for Arya: a grocery app that learns from your receipts, shares lists, and uses Meta models. What it is, how to try it, how it is built, and the evidence.">
      <main style={{padding: '4rem 1rem', maxWidth: 960, margin: '0 auto'}}>
        <h1 style={{fontSize: '2.6rem'}}>Arya docs</h1>
        <p style={{fontSize: '1.2rem'}}>Build for Your World, in three parts.</p>
        <ul style={{fontSize: '1.05rem'}}>
          <li><strong>What is Arya.</strong> Arya learns how you shop from your receipts and helps shoppers help each other.</li>
          <li><strong>Why I built it.</strong> I had this problem: carrying the list in my head, forgetting what was running out, not knowing where the money went. Arya frees up that time and mental space. It is for shoppers, and not for money: households and groups share lists and help each other. <Link to="/docs/principles">Principles</Link></li>
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
