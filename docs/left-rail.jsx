// Left rail — Navigation. Several layout variants.
// variant: 'standard' | 'compact' | 'grouped' | 'collapsed' | 'sectioned'

const LEFT_RAIL_W = { standard: 156, compact: 156, grouped: 156, collapsed: 44, sectioned: 168 };

function LeftRail({
  variant = 'standard',
  activeKind = 'space',           // 'space' | 'source'
  activeId = 'sales',
  spaces = [
    { id: 'sales',      name: 'Sales',      dot: '#2F5BFF' },
    { id: 'operations', name: 'Operations', dot: '#C58A1B' },
    { id: 'finance',    name: 'Finance',    dot: '#2D7A4F' },
  ],
  sources = ['Email', 'Plunet', 'Xero', 'Front'],
  onPick,
}) {
  const w = LEFT_RAIL_W[variant];
  const isCollapsed = variant === 'collapsed';

  const Row = ({ icon, label, active, muted, onClick }) => (
    <button
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8,
        height: 24, padding: isCollapsed ? '0' : '0 8px',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        borderRadius: 4, fontSize: 12,
        color: active ? 'var(--accent)' : (muted ? 'var(--ink-tertiary)' : 'var(--ink-primary)'),
        background: active ? 'var(--accent-tint)' : 'transparent',
        fontWeight: active ? 500 : 400,
      }}>
      {icon}
      {!isCollapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
    </button>
  );

  const SectionHdr = ({ children, action }) => (
    !isCollapsed && (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0 8px', marginBottom: 4,
        fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase',
        color: 'var(--ink-tertiary)', fontWeight: 500,
      }}>
        <span>{children}</span>
        {action}
      </div>
    )
  );

  const Dot = ({ color, size = 5 }) => (
    <div style={{ width: size, height: size, borderRadius: 999, background: color, flexShrink: 0 }} />
  );

  // ── grouped variant uses dividers + headers
  return (
    <div style={{
      ...Z.zone, width: w, flexShrink: 0,
      transition: 'width 200ms ease',
    }}>
      {/* product mark + collapse toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isCollapsed ? '10px 0' : '10px 10px',
        borderBottom: '0.5px solid var(--line-thin)',
      }}>
        {!isCollapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 4,
              background: 'var(--ink-primary)', color: 'var(--bg-surface)',
              display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700,
            }}>v</div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>viter</div>
          </div>
        )}
        <button style={{
          all: 'unset', cursor: 'pointer',
          width: 18, height: 18, display: 'grid', placeItems: 'center',
          color: 'var(--ink-tertiary)', borderRadius: 3, margin: isCollapsed ? '0 auto' : 0,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d={isCollapsed ? 'M3 1l4 4-4 4' : 'M7 1L3 5l4 4'} stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 14,
        padding: '12px 6px',
      }}>
        {/* SPACES */}
        <div>
          <SectionHdr action={!isCollapsed && <span style={{ fontSize: 11, color: 'var(--ink-quaternary)' }}>3</span>}>Spaces</SectionHdr>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {spaces.map((s) => (
              <Row key={s.id} icon={<Dot color={s.dot} />} label={s.name}
                   active={activeKind === 'space' && activeId === s.id}
                   onClick={() => onPick && onPick('space', s.id)} />
            ))}
            <Row icon={<Dot color="transparent" />} label="+ New" muted />
          </div>
        </div>

        {variant === 'grouped' && !isCollapsed && (
          <div style={{ height: 0.5, background: 'var(--line-thin)', margin: '0 8px' }} />
        )}

        {/* SOURCES */}
        <div>
          <SectionHdr action={!isCollapsed && <span style={{ fontSize: 11, color: 'var(--ink-quaternary)' }}>{sources.length}</span>}>Sources</SectionHdr>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {sources.map((s) => (
              <Row key={s} icon={<SourceTile name={s} size={12} />} label={s}
                   active={activeKind === 'source' && activeId === s.toLowerCase()}
                   onClick={() => onPick && onPick('source', s.toLowerCase())} />
            ))}
            <Row icon={<div style={{
              width: 12, height: 12, borderRadius: 3, boxShadow: 'inset 0 0 0 0.5px var(--line-strong)',
              display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--ink-tertiary)',
            }}>+</div>} label="+ Add" muted />
          </div>
        </div>

        {variant === 'sectioned' && !isCollapsed && (
          <>
            <div style={{ height: 0.5, background: 'var(--line-thin)', margin: '0 8px' }} />
            <div>
              <SectionHdr>Pinned</SectionHdr>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Row icon={<Dot color="var(--ink-tertiary)" />} label="Bayer Q3 quote" />
                <Row icon={<Dot color="var(--ink-tertiary)" />} label="Cash position" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* footer — user */}
      <div style={{
        borderTop: '0.5px solid var(--line-thin)',
        padding: isCollapsed ? '8px 0' : '8px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
        justifyContent: isCollapsed ? 'center' : 'flex-start',
      }}>
        <Avatar name="Jonas Kessler" size={20} />
        {!isCollapsed && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Jonas Kessler</div>
            <div style={{ fontSize: 10, color: 'var(--ink-tertiary)' }}>Acme GmbH</div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { LeftRail, LEFT_RAIL_W });
