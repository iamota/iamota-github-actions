#!/bin/bash
set -e

aws s3 cp "$FILE" "s3://$BUCKET/$DEST"
