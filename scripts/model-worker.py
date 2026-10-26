#!/usr/bin/env python3
"""Linux-only, isolated Blender conversion. No service credentials are inherited.

Default runtime: ~/.local/opt/blender-5.2.3-linux-x64
Optional user-local runtime libraries: ~/.local/opt/blender-libs/usr/lib64
Requires bubblewrap; it intentionally fails closed if isolation is unavailable.
"""
import os
from pathlib import Path
import resource
import sys

job = Path(sys.argv[1]).resolve(strict=True)
assert (job / 'source.blend').is_file() and (job / 'export.py').is_file()
runtime = Path.home() / '.local/opt/blender-5.2.3-linux-x64'
libraries = Path.home() / '.local/opt/blender-libs/usr/lib64'
assert (runtime / 'blender').is_file(), 'Blender runtime is missing'
# Limits inherited by bubblewrap and Blender. This personal server has 2 GiB RAM.
resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CPU, (120, 125))
resource.setrlimit(resource.RLIMIT_FSIZE, (110 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
args = [
    'bwrap', '--unshare-all', '--die-with-parent', '--new-session',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64', '--dir', '/etc',
    '--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache',
    '--ro-bind', str(runtime), '/blender', '--bind', str(job), '/job',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--chdir', '/job',
    '--setenv', 'HOME', '/tmp', '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'OMP_NUM_THREADS', '1',
    '--setenv', 'OPENBLAS_NUM_THREADS', '1',
]
if libraries.is_dir():
    args += ['--ro-bind', str(libraries), '/extra', '--setenv', 'LD_LIBRARY_PATH', '/extra']
args += ['/blender/blender', '--background', '--factory-startup', '--disable-autoexec',
         '--threads', '1', '--python-exit-code', '1', '--python', '/job/export.py']
os.environ.clear()
os.environ['PATH'] = '/usr/bin:/bin'
os.execvp(args[0], args)
