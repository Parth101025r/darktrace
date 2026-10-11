import { PageHeader } from './PageShell';
import ThreatBody from '../modules/ThreatIntelligence/ThreatIntelligence'; // Anshu

export default function ThreatIntelligence() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Threat Intelligence"
        description="Findings extracted from crawled sources. Search indicators, filter by severity and drill into the details."
      />
      <ThreatBody />
    </div>
  );
}
