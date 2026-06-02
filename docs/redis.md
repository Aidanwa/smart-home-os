to start redis server locally:

in WSL (UBUNTU):
sudo apt update
sudo apt install redis-server -y
sudo service redis-server start

Need to do this before running api for it to work. not necessary when using compose.