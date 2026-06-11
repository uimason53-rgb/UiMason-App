type Props = {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DeleteConfirmModal({ title, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card modal-card-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ fontSize: "18px" }}>Delete Chat?</h2>
          <p className="modal-subtitle">
            "{title}" will be permanently deleted.
          </p>
        </div>
        <div className="modal-footer modal-footer-row">
          <button className="modal-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="modal-btn-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
