/** Quiet stand-ins while a grid loads: the plates at their real size, so nothing jumps when the pieces land. */
export function CardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="card" key={i} aria-hidden="true">
          <div className="plate card-plate skel" />
          <div className="card-meta">
            <span className="skel skel-line" style={{ width: '58%' }} />
            <span className="skel skel-line" style={{ width: '18%' }} />
          </div>
        </div>
      ))}
    </>
  );
}
