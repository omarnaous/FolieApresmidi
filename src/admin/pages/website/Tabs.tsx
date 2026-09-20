import { NavLink } from 'react-router';

/**
 * The website screen has two halves: what the home page says, and what the
 * shop itself is called, charges in and measures by. They save to different
 * places, so each keeps its own Save — and these are links rather than
 * buttons, which means leaving one with changes still asks first.
 */
export function WebsiteTabs() {
  return (
    <nav className="adm-tabs" aria-label="Website design">
      <div className="adm-segmented">
        <NavLink to="/admin/website" end className="adm-seg">
          Home page
        </NavLink>
        <NavLink to="/admin/website/store" className="adm-seg">
          Store details
        </NavLink>
      </div>
    </nav>
  );
}
