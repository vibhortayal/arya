import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function ApiReference() {
  const specUrl = useBaseUrl('/openapi.json');
  return (
    <Layout title="API reference" description="Arya Lists API v1 (OpenAPI)">
      <BrowserOnly fallback={<p style={{padding: '2rem'}}>Loading the API reference…</p>}>
        {() => {
          const {RedocStandalone} = require('redoc');
          return <RedocStandalone specUrl={specUrl} options={{hideDownloadButton: false}} />;
        }}
      </BrowserOnly>
    </Layout>
  );
}
