/** @format */

import { isAbsoluteUrl } from "@/wab/commons/urls";
import * as React from "react";
import { Link as ReactRouterLink } from "react-router-dom";

type PublicLinkProps = React.ComponentProps<"a">;

export function PublicLink(props: PublicLinkProps) {
  if (!props.href || isAbsoluteUrl(props.href)) {
    // Use normal link for absolute URLs or when href is undefined
    return <a {...props} />;
  } else {
    // Use RR Link for internal navigation
    return (
      <ReactRouterLink {...(props as any)} href={undefined} to={props.href} />
    );
  }
}
