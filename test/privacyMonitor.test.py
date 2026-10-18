import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
from subprocess import CompletedProcess

spec = importlib.util.spec_from_file_location('privacy_monitor', Path(__file__).parents[1] / '_docs/privacy_ops/privacy-monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

class MonitorTest(unittest.TestCase):
    def testSchedule(self):
        self.assertTrue(monitor.shouldSend({}, True, 1))
        self.assertFalse(monitor.shouldSend({'alert': True, 'sent_at': 10}, True, 100))
        self.assertTrue(monitor.shouldSend({'alert': True, 'sent_at': 10}, True, 3610))
        self.assertTrue(monitor.shouldSend({'alert': True, 'sent_at': 10}, False, 11))
        self.assertFalse(monitor.shouldSend({}, False, 1))

    def testHostDetectsDeadContainerAndRedactsErrors(self):
        with patch.object(monitor.subprocess, 'run', return_value=CompletedProcess([], 1, 'sensitive', 'secret')):
            self.assertEqual(monitor.collectStatus('api'), {'monitor_unavailable': True})
        self.assertTrue(monitor.needsAlert({'monitor_unavailable': True}))

    def testOnlySafeFieldsReachMail(self):
        import json
        data = dict(failed_count=1, overdue_count=0, long_pending_count=0, pending_count=1, oldest_pending_seconds=10, worker_stale=False, resolution_overdue_count=0, push_worker_stale=False, push_long_pending_count=0, secret='hidden')
        with patch.object(monitor.subprocess, 'run', return_value=CompletedProcess([], 2, json.dumps(data), '')):
            result = monitor.collectStatus('api')
        self.assertNotIn('secret', result)
        self.assertTrue(monitor.needsAlert(result))

if __name__ == '__main__':
    unittest.main()
