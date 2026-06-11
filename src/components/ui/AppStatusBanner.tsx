type AppStatusBannerProps = {
  message: string;
  variant?: "info" | "error";
  onClose?: () => void;
};

export default function AppStatusBanner({ message, variant = "info", onClose }: AppStatusBannerProps) {
  return (
    <div className={`app-status-banner app-status-banner--${variant}`}>
      <span>{message}</span>
      {onClose && (
        <button type="button" className="app-status-banner__close" onClick={onClose}>
          Dismiss
        </button>
      )}
    </div>
  );
}
