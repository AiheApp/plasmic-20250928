/** @format */

import { isAbsoluteUrl } from "@/wab/commons/urls";
import * as React from "react";
import { Link as ReactRouterLink } from "react-router-dom";

type PublicLinkProps = React.ComponentProps<"a">;

export function PublicLink({ href, ...rest }: PublicLinkProps) {
  if (!href || isAbsoluteUrl(href)) {
    // Use normal <a> for absolute URLs or when href is undefined
    return <a href={href} {...rest} />;
  } else {
    // Use React Router <Link> for internal navigation
    return <ReactRouterLink to={href} {...rest} />;
  }
}
