#!/bin/bash
set -e

theme deploy \
  --password="$SHOPIFY_CLI_THEME_TOKEN" \
  --store="$SHOPIFY_FLAG_STORE" \
  --themeid="$SHOPIFY_FLAG_THEME_ID" \
  --dir="$SHOPIFY_FLAG_PATH" \
  ${SHOPIFY_FLAG_IGNORE:+--ignored-file="$SHOPIFY_FLAG_IGNORE"}
