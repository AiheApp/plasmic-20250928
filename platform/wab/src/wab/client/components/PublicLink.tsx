/** @format */

import { isAbsoluteUrl } from "@/wab/commons/urls";
import * as React from "react";
import { Link as ReactRouterLink, LinkProps } from "react-router-dom";

// We want <a> props + optional href
type PublicLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
};

export function PublicLink({ href, children, ...rest }: PublicLinkProps) {
  if (!href || isAbsoluteUrl(href)) {
    // External or no href → use normal <a>
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  } else {
    // Internal navigation → use React Router Link
    return (
      <ReactRouterLink to={href} {...(rest as Omit<LinkProps, "to">)}>
        {children}
      </ReactRouterLink>
    );
  }
}
