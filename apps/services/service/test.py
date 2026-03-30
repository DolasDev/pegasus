import time
import sys

try:
    mode = sys.argv[1]
    file = sys.argv[2]
except Exception:
    mode = None

while True:
    f = open(file, "a")
    f.write("Now the file has more content! \n")
    f.write(mode + '\n')
    f.write(file + '\n')
    f.close()

    print("This prints once every 10 seconds.")
    print(mode)
    time.sleep(10) # Delay for 1 minute (60 seconds).