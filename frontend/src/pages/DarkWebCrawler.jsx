import { useApp } from '../context/AppContext';
import { PageHeader } from './PageShell';
import CrawlerTab from '../modules/DarkWebCrawler/CrawlerTab'; // Himanshu

export default function DarkWebCrawler() {
  const { crawlerStatus, setCrawlerStatus } = useApp(); // shared status -> rain, globe and spider react to it
  return (
    <div className="page">
      <PageHeader
        eyebrow="Collection"
        title="Dark Web Crawler"
        description="Control the crawl job, watch live fetches across Tor, I2P and Telegram, and inspect the activity log."
      />
      <div className="crawler-host">
        <CrawlerTab crawlerStatus={crawlerStatus} onCrawlerStatusChange={setCrawlerStatus} />
      </div>
    </div>
  );
}
