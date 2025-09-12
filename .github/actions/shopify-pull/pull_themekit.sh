#!/bin/bash
set -e

mkdir -p backup

theme get \
  --password="$SHOPIFY_CLI_THEME_TOKEN" \
  --store="$SHOPIFY_FLAG_STORE" \
  --themeid="$SHOPIFY_FLAG_THEME_ID" \
  --dir=backup
