import math


EPSILON = 0.001


def world_points(item):
    points = item.get('points') or [[0, 0], [item['width'], 0], [item['width'], item['height']], [0, item['height']]]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cosine, sine = math.cos(item.get('angle', 0)), math.sin(item.get('angle', 0))
    return [(item['x'] + cx + (x - cx) * cosine - (y - cy) * sine,
             item['y'] + cy + (x - cx) * sine + (y - cy) * cosine) for x, y in points]


def bounds(item, padding=0):
    points = world_points(item)
    return (min(p[0] for p in points) - padding, min(p[1] for p in points) - padding,
            max(p[0] for p in points) + padding, max(p[1] for p in points) + padding)


def segment_hits_box(start, end, box):
    left, top, right, bottom = box
    left, top, right, bottom = left + EPSILON, top + EPSILON, right - EPSILON, bottom - EPSILON
    if left >= right or top >= bottom:
        return False
    low, high = 0.0, 1.0
    for origin, change, minimum, maximum in ((start[0], end[0] - start[0], left, right), (start[1], end[1] - start[1], top, bottom)):
        if abs(change) < 1e-12:
            if origin < minimum or origin > maximum:
                return False
        else:
            first, last = sorted(((minimum - origin) / change, (maximum - origin) / change))
            low, high = max(low, first), min(high, last)
            if low > high:
                return False
    return high > EPSILON and low < 1 - EPSILON


def connector_crossings(scene, padding=0, title_boxes=None):
    records = {item['id']: item for item in scene['elements'] if not item.get('isDeleted')}
    violations = []
    for arrow in records.values():
        if arrow['type'] != 'arrow':
            continue
        assert not arrow.get('roundness') and arrow.get('routing') != 'curved', 'Oracle requires actual straight SVG path segments'
        own_hosts = {arrow[key]['elementId'] for key in ('startBinding', 'endBinding') if arrow.get(key)}
        points = world_points(arrow)
        for obstacle in records.values():
            if obstacle['id'] in own_hosts or obstacle.get('containerId') == arrow['id'] or obstacle.get('containerId') in own_hosts:
                continue
            if title_boxes and obstacle['type'] == 'frame':
                box = title_boxes[obstacle['id']]
            elif obstacle['type'] in ('rectangle', 'ellipse', 'diamond', 'text'):
                box = bounds(obstacle, padding)
            else:
                continue
            for index, (start, end) in enumerate(zip(points, points[1:])):
                if segment_hits_box(start, end, box):
                    violations.append({'arrow': arrow['id'], 'obstacle': obstacle['id'], 'obstacle_type': obstacle['type'],
                                       'segment': index, 'points': [start, end], 'bounds': box})
    return violations


def marker_crossings(scene, title_boxes=None):
    records = {item['id']: item for item in scene['elements'] if not item.get('isDeleted')}
    violations = []
    for arrow in records.values():
        if arrow['type'] != 'arrow':
            continue
        points = world_points(arrow)
        for endpoint, head in ((0, arrow.get('startArrowhead')), (-1, arrow.get('endArrowhead'))):
            if not head:
                continue
            assert head in ('arrow', 'triangle'), ('Unimplemented marker oracle', head)
            tip, previous = points[endpoint], points[1 if endpoint == 0 else -2]
            dx, dy = tip[0] - previous[0], tip[1] - previous[1]
            length = math.hypot(dx, dy)
            assert length > 0, ('Zero-length terminal marker segment', arrow['id'])
            ux, uy = dx / length, dy / length
            size = max(16, arrow.get('strokeWidth', 1) * 4)
            own_binding = arrow.get('startBinding' if endpoint == 0 else 'endBinding')
            own_host = own_binding['elementId'] if own_binding else None
            if length < size + arrow.get('strokeWidth', 1):
                violations.append({'arrow': arrow['id'], 'end': endpoint, 'terminal_segment_too_short': length, 'marker_size': size})
            vertices = [(tip[0] - size * ux + sign * size * .5 * -uy,
                         tip[1] - size * uy + sign * size * .5 * ux) for sign in (-1, 1)] + [tip]
            for obstacle in records.values():
                if obstacle['id'] == own_host or (own_host and obstacle.get('containerId') == own_host) or obstacle.get('containerId') == arrow['id']:
                    continue
                if obstacle['type'] == 'frame' and title_boxes:
                    box = title_boxes[obstacle['id']]
                elif obstacle['type'] in ('rectangle', 'ellipse', 'diamond', 'text'):
                    box = bounds(obstacle, arrow.get('strokeWidth', 1) / 2 + 1)
                else:
                    continue
                if any(segment_hits_box(a, b, box) for a, b in zip(vertices, vertices[1:] + vertices[:1])):
                    violations.append({'arrow': arrow['id'], 'end': endpoint, 'obstacle': obstacle['id'], 'marker_vertices': vertices, 'bounds': box})
    return violations


def marker_negative_control():
    source = {'id': 'near-source', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 100, 'height': 100}
    target = {**source, 'id': 'near-target', 'x': 104}
    arrow = {'id': 'short-arrow', 'type': 'arrow', 'x': 100, 'y': 50, 'width': 4, 'height': 0,
             'points': [[0, 0], [4, 0]], 'strokeWidth': 2, 'endArrowhead': 'arrow',
             'startBinding': {'elementId': source['id']}, 'endBinding': {'elementId': target['id']}}
    violations = marker_crossings({'elements': [source, target, arrow]})
    assert any(item.get('obstacle') == source['id'] for item in violations), 'Marker oracle missed a 4px arrowhead inside its source'
    return {'short_arrow_marker_inside_source': 'REPRODUCED', 'violations': violations}


def native_references(scene):
    records = {item['id']: item for item in scene['elements']}
    for item in records.values():
        for field in ('frameId', 'containerId'):
            if item.get(field):
                assert item[field] in records, (item['id'], field, item[field])
                if field == 'frameId':
                    assert records[item[field]]['type'] == 'frame', (item['id'], field)
                else:
                    assert any(reference['id'] == item['id'] for reference in records[item[field]].get('boundElements') or []), ('Missing native label back-reference', item['id'])
        for field in ('startBinding', 'endBinding'):
            if item.get(field):
                binding = item[field]
                assert binding['elementId'] in records, (item['id'], field)
                assert binding.get('fixedPoint') is not None, (item['id'], 'missing finalized binding point')
                assert any(reference['id'] == item['id'] for reference in records[binding['elementId']].get('boundElements') or []), ('Missing native arrow back-reference', item['id'], field)
        for binding in item.get('boundElements') or []:
            assert binding['id'] in records, (item['id'], 'boundElements', binding)


def geometry_equivalent(before, after):
    assert len(before['elements']) == len(after['elements']), 'Native element count changed'
    mapping = {a['id']: b['id'] for a, b in zip(before['elements'], after['elements'])}
    dx = after['elements'][0]['x'] - before['elements'][0]['x']
    dy = after['elements'][0]['y'] - before['elements'][0]['y']

    def normalized(value, key=None):
        if isinstance(value, dict):
            return {field: normalized(child, field) for field, child in value.items()
                    if field not in ('version', 'versionNonce', 'updated')}
        if isinstance(value, list):
            return [normalized(child, key) for child in value]
        if isinstance(value, str) and key in ('id', 'elementId', 'frameId', 'containerId'):
            return mapping.get(value, value)
        return value

    for a, b in zip(before['elements'], after['elements']):
        translated = {**a, 'x': a['x'] + dx, 'y': a['y'] + dy}
        expected, actual = normalized(translated), normalized(b)
        for field in ('x', 'y'):
            assert abs(expected[field] - actual[field]) < EPSILON, (a['id'], field, expected[field], actual[field])
            expected.pop(field)
            actual.pop(field)
        assert expected == actual, {'id': a['id'], 'changed_fields': {field: [expected.get(field), actual.get(field)]
                                                                  for field in expected.keys() | actual.keys() if expected.get(field) != actual.get(field)}}
    assert before.get('files', {}) == after.get('files', {}), 'Native files changed'
    native_references(after)
    return {'translation': [dx, dy], 'remapped_ids': sum(key != value for key, value in mapping.items()), 'elements': len(mapping)}


def shape_collisions(scene, permissions=()):
    records = [item for item in scene['elements'] if not item.get('isDeleted') and item['type'] in ('rectangle', 'ellipse', 'diamond', 'text')]
    allowed = {frozenset((item['firstId'], item['secondId'])) for item in permissions}
    collisions = []
    for index, first in enumerate(records):
        for second in records[index + 1:]:
            if first.get('containerId') == second['id'] or second.get('containerId') == first['id']:
                continue
            first_host, second_host = first.get('containerId') or first['id'], second.get('containerId') or second['id']
            if first_host == second_host or frozenset((first_host, second_host)) in allowed:
                continue
            a, b = bounds(first), bounds(second)
            if min(a[2], b[2]) - max(a[0], b[0]) > EPSILON and min(a[3], b[3]) - max(a[1], b[1]) > EPSILON:
                collisions.append({'first': first['id'], 'second': second['id'], 'bounds': [a, b]})
    return collisions
