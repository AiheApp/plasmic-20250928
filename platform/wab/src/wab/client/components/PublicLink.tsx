/** @format */

import { isAbsoluteUrl } from "@/wab/commons/urls";
import * as React from "react";
import { Link as ReactRouterLink } from "react-router-dom";

type PublicLinkProps = React.ComponentProps<"a">;

export function PublicLink({ href, ...rest }: PublicLinkProps) {
  // Case 1: No href -> render span (or nothing) to avoid invalid Link
  if (!href) {
    console.warn("⚠️ PublicLink called without href", rest);
    return <span {...rest} />;
  }

  // Case 2: Absolute URL -> render <a>
  if (isAbsoluteUrl(href)) {
    return <a href={href} {...rest} />;
  }

  // Case 3: Relative path -> render React Router <Link>
  return <ReactRouterLink to={href} {...rest} />;
}
