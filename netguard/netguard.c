/* netguard: while a lock file exists, refuse outbound TCP/UDP from this
 * process (loopback and unix sockets stay usable). It is loaded only into
 * shell children through LD_PRELOAD, so the harness engine's own model
 * connection is untouched.
 *
 * Lock file path: $DSH_NETGUARD_LOCK when set, else
 * /root/.dsh/dsh-go/netguard.lock. The installed bash wrapper exports both
 * LD_PRELOAD and that path, so a different $DSH_HOME works too.
 *
 * Build: tcc -shared -fPIC -o netguard.so netguard.c
 *    or: gcc -shared -fPIC -O2 -o netguard.so netguard.c
 */
typedef unsigned long size_t;
typedef unsigned int socklen_t;
typedef unsigned short sa_family_t;

struct sockaddr { sa_family_t sa_family; char sa_data[14]; };

extern void *dlsym(void *handle, const char *symbol);
extern char *getenv(const char *name);
extern int open(const char *pathname, int flags, ...);
extern int close(int fd);
extern int *__errno_location(void);

#define RTLD_NEXT ((void *) -1L)
#define AF_UNIX 1
#define AF_INET 2
#define AF_INET6 10
#define ECONNREFUSED 111
#define O_RDONLY 0

static int locked(void) {
  char *path = getenv("DSH_NETGUARD_LOCK");
  int fd = open(path != 0 && path[0] != 0 ? path : "/root/.dsh/dsh-go/netguard.lock", O_RDONLY);
  if (fd < 0) return 0;
  close(fd);
  return 1;
}

static int loopback(const struct sockaddr *addr) {
  const unsigned char *b;
  unsigned short fam;
  int i;
  if (addr == 0) return 1;
  fam = addr->sa_family;
  if (fam == AF_UNIX) return 1;
  b = (const unsigned char *) addr;
  if (fam == AF_INET) return b[4] == 127;
  if (fam == AF_INET6) {
    for (i = 0; i < 15; i++) if (b[8 + i] != 0) return 0;
    return b[23] == 1;
  }
  return 1;
}

typedef int (*connect_fn)(int, const struct sockaddr *, socklen_t);
typedef long (*sendto_fn)(int, const void *, size_t, int, const struct sockaddr *, socklen_t);

int connect(int fd, const struct sockaddr *addr, socklen_t len) {
  static connect_fn real;
  if (!real) real = (connect_fn) dlsym(RTLD_NEXT, "connect");
  if (locked() && !loopback(addr)) { *__errno_location() = ECONNREFUSED; return -1; }
  return real(fd, addr, len);
}

long sendto(int fd, const void *buf, size_t n, int flags, const struct sockaddr *addr, socklen_t len) {
  static sendto_fn real;
  if (!real) real = (sendto_fn) dlsym(RTLD_NEXT, "sendto");
  if (locked() && !loopback(addr)) { *__errno_location() = ECONNREFUSED; return -1; }
  return real(fd, buf, n, flags, addr, len);
}
