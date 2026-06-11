export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-eyebrow">
        <span className="hero-eyebrow-dot" />
        AI-Powered Development
      </div>

      <h1 className="hero-title">
        Build Entire Software
        <span className="hero-gradient"> With One Prompt</span>
      </h1>

      <p className="hero-description">
        Describe your product idea. UiMason plans architecture,
        writes code, fixes errors and prepares deployment.
      </p>

      <div className="hero-stats">
        <div className="hero-stat">
          <span className="hero-stat-value">10x</span>
          <span className="hero-stat-label">Faster</span>
        </div>
        <div className="hero-stat-divider" />
        <div className="hero-stat">
          <span className="hero-stat-value">∞</span>
          <span className="hero-stat-label">Languages</span>
        </div>
        <div className="hero-stat-divider" />
        <div className="hero-stat">
          <span className="hero-stat-value">1</span>
          <span className="hero-stat-label">Prompt</span>
        </div>
      </div>
    </section>
  );
}