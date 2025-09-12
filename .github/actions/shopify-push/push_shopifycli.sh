#!/bin/bash
set -e

shopify theme push \
  --store "$SHOPIFY_FLAG_STORE" \
  --theme "$SHOPIFY_FLAG_THEME_ID" \
  --password "$SHOPIFY_CLI_THEME_TOKEN" \
  --path "$SHOPIFY_FLAG_PATH" \
  ${SHOPIFY_FLAG_IGNORE:+--ignore "$SHOPIFY_FLAG_IGNORE"} \
  ${SHOPIFY_FLAG_ALLOW_LIVE:+--allow-live} \
  ${NODELETE_FLAG} \
  --verbose
