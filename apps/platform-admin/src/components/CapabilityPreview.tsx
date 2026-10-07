import type { Capability, Tenant } from '@elixir/contracts';
import { Badge, Icon, InlineAlert } from '@elixir/ui';
import { CAP_SOURCE_LABEL, capLabel, capabilityBreakdown, capabilityDiff, type CapSource } from '../lib/platform';

type Shape = Pick<Tenant, 'vertical' | 'plan' | 'addOns' | 'capabilityOverrides' | 'capabilityRestrictions' | 'subscriptionStatus'>;

export function FormulaBanner({ compact }: { compact?: boolean }) {
  return (
    <div className={`pa-formula${compact ? ' pa-formula--compact' : ''}`} aria-label="Effective capabilities formula">
      <span className="pa-formula__label">Effective capabilities =</span>
      {(['Core', 'Vertical', 'Plan', 'Add-ons', 'Overrides'] as const).map((t, i) => (
        <span key={t} className="pa-formula__term">
          {i ? <span className="pa-formula__op">+</span> : null}
          <b>{t}</b>
        </span>
      ))}
      <span className="pa-formula__op">−</span>
      <b className="pa-formula__neg">Restrictions</b>
    </div>
  );
}

/** Live effective-capability preview grouped by source, with diff against the saved state. */
export function CapabilityPreview({ after, before }: { after: Shape; before?: Shape }) {
  const b = capabilityBreakdown(after);
  const diff = before ? capabilityDiff(before, after) : { gained: [], lost: [] };
  const gained = new Set<Capability>(diff.gained);
  const groups: CapSource[] = ['core', 'vertical', 'plan', 'add-on', 'override'];
  return (
    <div className="pa-capprev">
      {b.suspended ? (
        <InlineAlert tone="danger" icon="Ban" title="Suspended — security revocation path">
          While suspended the tenant keeps only historic read access (Reports). Plan and add-ons are retained and return on reactivation.
        </InlineAlert>
      ) : null}
      <div className="pa-capprev__summary">
        <span>
          <b className="num">{b.effective.length}</b> effective {b.effective.length === 1 ? 'capability' : 'capabilities'}
        </span>
        {before ? (
          <>
            <Badge tone={diff.gained.length ? 'success' : 'neutral'} icon="Plus">
              {diff.gained.length} gained
            </Badge>
            <Badge tone={diff.lost.length ? 'danger' : 'neutral'} icon="Minus">
              {diff.lost.length} lost
            </Badge>
          </>
        ) : null}
      </div>
      {groups.map((g) =>
        b.bySource[g].length ? (
          <div key={g} className="pa-capprev__group">
            <div className="pa-capprev__head">
              {CAP_SOURCE_LABEL[g]} <span className="muted num">{b.bySource[g].length}</span>
            </div>
            <div className="pa-chips">
              {b.bySource[g].map((c) => (
                <span key={c} className={`pa-cap${gained.has(c) ? ' pa-cap--gained' : ''}`} title={c}>
                  {gained.has(c) ? <Icon name="Plus" size={11} /> : null}
                  {capLabel(c)}
                  {gained.has(c) ? <span className="sr-only"> (gained)</span> : null}
                </span>
              ))}
            </div>
          </div>
        ) : null,
      )}
      {b.restricted.length ? (
        <div className="pa-capprev__group">
          <div className="pa-capprev__head">
            Restrictions <span className="muted num">{b.restricted.length}</span>
          </div>
          <div className="pa-chips">
            {b.restricted.map((c) => (
              <span key={c} className="pa-cap pa-cap--restricted" title={c}>
                <Icon name="Ban" size={11} />
                {capLabel(c)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {diff.lost.length ? (
        <div className="pa-capprev__group">
          <div className="pa-capprev__head pa-tone-danger">
            Will be lost <span className="num">{diff.lost.length}</span>
          </div>
          <div className="pa-chips">
            {diff.lost.map((c) => (
              <span key={c} className="pa-cap pa-cap--lost" title={c}>
                <Icon name="Minus" size={11} />
                {capLabel(c)}
                <span className="sr-only"> (lost)</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
