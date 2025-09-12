#!/bin/bash
set -e

mkdir -p backup

shopify theme pull \
  --store "$SHOPIFY_FLAG_STORE" \
  --theme "$SHOPIFY_FLAG_THEME_ID" \
  --password "$SHOPIFY_CLI_THEME_TOKEN" \
  --path ./backup \
  --nodelete
