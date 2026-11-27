cd /c/Users/WINDOWS\ 11\ PRO/Documents/hotclip
echo "---ARCHIVE CONTENTS---"
ls -la /tmp/hotclip-deploy
echo "---WEB SRC---"
ls /tmp/hotclip-deploy/web/src/app/(auth)
echo "---GIT TREE SIZE---"
git ls-tree -r --name-only main | wc -l
