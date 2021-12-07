$!/usr/bin/env bash
count=$(git status | grep -c modified)
if [[ $count -gt 0 ]]; then
    echo "It looks like you forgot to run 'npm run build', please run this command and recommit"
    exit 1
fi
echo "No new files detected"
